import { demoAdminUser, demoRequest } from "./demo";

export const mode = import.meta.env.VITE_APP_MODE || "api";
export const showcase = mode === "showcase";
export const demoMode = mode === "demo";
const apiBase = import.meta.env.VITE_API_URL || "/api";
const DEMO_ACCOUNTS = "tokenflow-demo-accounts-v1";
if (sessionStorage.getItem("tf-auth-version") !== "2") {
	sessionStorage.removeItem("tf-admin");
	sessionStorage.removeItem("tf-admin-token");
	localStorage.removeItem("tf-guest-token");
	sessionStorage.setItem("tf-auth-version", "2");
}
let firebaseAuth, firestore, authModule, firebaseReady;
async function firebase() {
 if(!firebaseReady)firebaseReady=(async()=>{
  const {initializeApp,getApps,getApp}=await import('firebase/app');
  authModule=await import('firebase/auth');const {getFirestore}=await import('firebase/firestore');
  const app=getApps().length?getApp():initializeApp({apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID});
  firebaseAuth=authModule.getAuth(app);await firebaseAuth.authStateReady();firestore=getFirestore(app);return firebaseAuth;
 })().catch(e=>{firebaseReady=undefined;throw e});
 return firebaseReady;
}

function accounts() {
	try {
		return JSON.parse(localStorage.getItem(DEMO_ACCOUNTS) || "[]");
	} catch {
		return [];
	}
}

async function passwordHash(password, salt) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
		key,
		256,
	);
	return Array.from(new Uint8Array(bits), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
}

async function demoAccount(name, email, password, role) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const encodedSalt = Array.from(salt, (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
	return {
		uid: crypto.randomUUID(),
		name,
		email: email.trim().toLowerCase(),
		role,
		salt: encodedSalt,
		passwordHash: await passwordHash(password, salt),
	};
}

function saltBytes(value) {
	return new Uint8Array(value.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
}

function saveSession(role, result) {
	if (role === "admin") {
		sessionStorage.setItem("tf-admin", "yes");
		if (result.token) sessionStorage.setItem("tf-admin-token", result.token);
		if (result.user?.uid) sessionStorage.setItem("tf-demo-admin-uid", result.user.uid);
		sessionStorage.removeItem("tf-user");
		// Keep customer identity available for an explicit later sign-in; never use it while admin is active.
		return;
	}
	sessionStorage.setItem("tf-user", "yes");
	if (result.token) localStorage.setItem("tf-user-token", result.token);
	if (result.user?.uid) localStorage.setItem("tf-demo-uid", result.user.uid);
	if (result.user?.name) localStorage.setItem("tf-user-name", result.user.name);
	sessionStorage.removeItem("tf-admin");
	sessionStorage.removeItem("tf-admin-token");
}

async function localAuth(path, payload) {
	const response = await fetch(`${apiBase}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	const result = await parseResponse(response);
	if (!response.ok) throw requestError(response,result);
	return result.data;
}

export async function registerUser(name, email, password) {
	let result;
	if (showcase || demoMode) {
		const list = accounts();
		if (list.some((account) => account.email === email.trim().toLowerCase()))
			throw Error("An account with this email already exists.");
		const user = await demoAccount(name.trim(), email, password, "customer");
		list.push(user);
		localStorage.setItem(DEMO_ACCOUNTS, JSON.stringify(list));
		result = { user };
	} else if (mode === "firebase") {
		await firebase();
		const credential = await authModule.createUserWithEmailAndPassword(
			firebaseAuth,
			email,
			password,
		);
		await authModule.updateProfile(credential.user, { displayName: name.trim() });
		result = {
			user: {
				uid: credential.user.uid,
				name: name.trim(),
				email: credential.user.email,
				role: "customer",
			},
		};
	} else {
		result = await localAuth("/auth/register", { name, email, password });
	}
	saveSession("customer", result);
	return result.user;
}

export async function loginUser(email, password) {
	let result;
	if (showcase || demoMode) {
		const account = accounts().find(
			(item) => item.email === email.trim().toLowerCase() && item.role === "customer",
		);
		if (!account || account.passwordHash !== (await passwordHash(password, saltBytes(account.salt))))
			throw Error("Email or password is incorrect.");
		result = { user: account };
	} else if (mode === "firebase") {
		await firebase();
		const credential = await authModule.signInWithEmailAndPassword(
			firebaseAuth,
			email,
			password,
		);
		const profile = await api("/me");
		if (profile.role !== "customer") {
			await authModule.signOut(firebaseAuth);
			throw Error("This account does not have User access.");
		}
		result = {
			user: {
				uid: credential.user.uid,
				name: credential.user.displayName || "",
				email: credential.user.email,
				role: "customer",
			},
		};
	} else {
		result = await localAuth("/auth/login", { email, password, role: "customer" });
	}
	saveSession("customer", result);
	return result.user;
}

export async function loginAdmin(email, password) {
	let result;
	if (demoMode) {
		result = { user: demoAdminUser(email, password) };
	} else if (showcase) {
		const account = accounts().find(
			(item) => item.email === email.trim().toLowerCase() && item.role === "admin",
		);
		if (!account || account.passwordHash !== (await passwordHash(password, saltBytes(account.salt))))
			throw Error("Email or password is incorrect.");
		result = { user: account };
	} else if (mode === "firebase") {
		await firebase();
		const credential = await authModule.signInWithEmailAndPassword(
			firebaseAuth,
			email,
			password,
		);
		const profile = await api("/me");
		if (profile.role !== "admin") {
			await authModule.signOut(firebaseAuth);
			throw Error("This account does not have Admin access.");
		}
		result = { user: { uid: credential.user.uid, role: "admin" } };
	} else {
		result = await localAuth("/auth/login", { email, password, role: "admin" });
	}
	saveSession("admin", result);
	return result.user;
}

export async function setupAdmin(setupKey = "") {
	let result;
	if (showcase) {
		const list = accounts();
		if (list.some((account) => account.role === "admin"))
			throw Error("Admin setup has already been completed.");
		const email = `admin-${crypto.randomUUID().slice(0, 8)}@tokenflow.local`;
		const password = `Tf-${crypto.randomUUID()}!`;
		const user = await demoAccount("Administrator", email, password, "admin");
		list.push(user);
		localStorage.setItem(DEMO_ACCOUNTS, JSON.stringify(list));
		result = { email, password, user };
	} else {
		result = await localAuth("/auth/admin/setup", {setupKey});
	}
	saveSession("admin", result);
	return { email: result.email, password: result.password };
}

export async function adminSetupAvailable() {
	if (demoMode) return false;
	if (showcase) return !accounts().some((account) => account.role === "admin");
	if (mode === "firebase") return false;
	const response = await fetch(`${apiBase}/auth/admin/setup-status`);
	const result = await parseResponse(response);
	return response.ok && result.data.available;
}

export async function logout(role = "admin") {
	if (role === "admin") {
		sessionStorage.removeItem("tf-admin");
		sessionStorage.removeItem("tf-admin-token");
		sessionStorage.removeItem("tf-demo-admin-uid");
	} else {
		sessionStorage.removeItem("tf-user");
		// Keep customer identity available for an explicit later sign-in; never use it while admin is active.
	}
	if (mode === "firebase") {
		await firebase();
		await authModule.signOut(firebaseAuth);
	}
}

async function token() {
	if (mode === "firebase") {
		await firebase();
		if (!firebaseAuth.currentUser) throw Error("Sign in to continue.");
		return firebaseAuth.currentUser.getIdToken();
	}
	const value =
		sessionStorage.getItem("tf-admin-token") ||
		localStorage.getItem("tf-user-token");
	if (!value) throw Error("Sign in to continue.");
	return value;
}

export async function api(path, method = "GET", body) {
	if (showcase || demoMode)
		return demoRequest(
			path,
			method,
			path === "/tokens" && method === "POST"
				? { ...body, displayName: body?.displayName || localStorage.getItem("tf-user-name") || "" }
				: body,
			sessionStorage.getItem("tf-admin") === "yes"
				? sessionStorage.getItem("tf-demo-admin-uid") || "demo-admin"
				: localStorage.getItem("tf-demo-uid") || "demo-user",
		);
	const response = await fetch(`${apiBase}${path}`, {
		method,
        signal:AbortSignal.timeout(12000),
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${await token()}`,
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const result = await parseResponse(response);
	if (!response.ok) throw requestError(response,result);
	return result.data;
}

export async function publicApi(path, key = "") {
	if (showcase || demoMode) return demoRequest(path, "GET", {shareKey:key}, "public");
	const response = await fetch(`${apiBase}${path}`, { cache: "no-store",headers:key?{Authorization:`Ticket ${key}`}:{},signal:AbortSignal.timeout(12000) });
	const result = await parseResponse(response);
	if (!response.ok) throw requestError(response,result);
	return result.data;
}

export async function subscribe(refresh) {
	if (mode !== "firebase") return () => {};
	await token();
	const { doc, onSnapshot } = await import("firebase/firestore");
	return onSnapshot(doc(firestore, "public_queue", "summary"), refresh, () => refresh());
}

async function parseResponse(response){try{return await response.json()}catch{throw Error('The API did not return JSON. Check VITE_API_URL and backend availability.')}}
function requestError(response,result){const e=Error(result.message||'Request failed');e.status=response.status;if(response.status===401&&!String(result.message).includes('QR')){sessionStorage.removeItem('tf-user');sessionStorage.removeItem('tf-admin');window.dispatchEvent(new Event('tokenflow-auth-expired'))}return e}
