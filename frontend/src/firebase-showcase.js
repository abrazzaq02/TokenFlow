// Only aliased into the offline showcase build. Firebase API mode uses the real SDK.
export function initializeApp(){throw Error('Build with Firebase dependencies to use live mode.')}
export const getAuth=initializeApp,getFirestore=initializeApp,signInAnonymously=initializeApp,signInWithEmailAndPassword=initializeApp,signOut=initializeApp,doc=initializeApp,onSnapshot=initializeApp;
