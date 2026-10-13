import re
import secrets
import uuid

from flask import request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from services.engine import Problem

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def credentials(email, password):
    email = email.strip().lower() if isinstance(email, str) else ""
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        raise Problem("Enter a valid email address")
    if not isinstance(password, str) or not 8 <= len(password) <= 256:
        raise Problem("Password must contain 8 to 256 characters")
    return email, password


def register_user(store, name, email, password):
    name = name.strip() if isinstance(name, str) else ""
    if not name or len(name) > 60:
        raise Problem("Name must contain 1 to 60 characters")
    email, password = credentials(email, password)
    user = {"uid": uuid.uuid4().hex, "name": name, "email": email, "role": "customer"}
    store.create_account(
        user["uid"], name, email, generate_password_hash(password), user["role"]
    )
    return user


def authenticate(store, email, password, role):
    email = email.strip().lower() if isinstance(email, str) else ""
    password = password if isinstance(password, str) else ""
    account = store.account(email)
    if (
        not account
        or account["role"] != role
        or not check_password_hash(account["password_hash"], password)
    ):
        raise Problem("Email or password is incorrect", 401)
    return {
        "uid": account["uid"],
        "name": account["name"],
        "email": account["email"],
        "role": account["role"],
    }


def create_admin(store):
    if store.has_admin():
        raise Problem("Admin setup has already been completed", 409)
    email = f"admin-{secrets.token_hex(5)}@tokenflow.local"
    password = secrets.token_urlsafe(18)
    user = {
        "uid": uuid.uuid4().hex,
        "name": "Administrator",
        "email": email,
        "role": "admin",
    }
    store.create_account(
        user["uid"], user["name"], email, generate_password_hash(password), user["role"]
    )
    return user, password


def issue(app, user):
    info = {
        "uid": user["uid"],
        "role": user["role"],
        "displayName": user.get("name", ""),
        "departmentIds": ["*"] if user["role"] == "admin" else [],
    }
    token = URLSafeTimedSerializer(app.config["SECRET_KEY"]).dumps(info)
    return {"token": token, "user": user}


def actor(app):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise Problem("Sign in to continue", 401)
    token = header[7:]

    if app.config["STORE_MODE"] == "firestore":
        from firebase_admin import auth, firestore

        try:
            info = auth.verify_id_token(token, check_revoked=True)
            doc = firestore.client().collection("users").document(info["uid"]).get()
            profile = doc.to_dict() if doc.exists else {}
            if profile.get("isActive") is False:
                raise Problem("Account is disabled", 403)
            profile_role = profile.get("role")
            if profile_role == "staff":
                raise Problem("Staff accounts are disabled", 403)
            role = "admin" if profile_role == "admin" else "customer"
            return {
                "uid": info["uid"],
                "role": role,
                "displayName": info.get("name", ""),
                "departmentIds": profile.get("departmentIds", []) if role == "admin" else [],
            }
        except Problem:
            raise
        except Exception:
            raise Problem("Your sign-in expired. Sign in again.", 401)

    try:
        info = URLSafeTimedSerializer(app.config["SECRET_KEY"]).loads(
            token, max_age=86400
        )
        if info.get("uid") == "demo-admin" or info.get("role") not in ("admin", "customer"):
            raise Problem("Sign in again with your account", 401)
        return info
    except (BadSignature, SignatureExpired):
        raise Problem("Your session expired. Sign in again.", 401)
