// firebase-config.js — inicialização do Firebase (Auth + Firestore)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Configuração real do projeto aprovadorgavea
const firebaseConfig = {
  apiKey: "AIzaSyBjQl0Lj4GTwaF1wdkMTDkNIFIJESr8E1s",
  authDomain: "aprovadorgavea.firebaseapp.com",
  projectId: "aprovadorgavea",
  storageBucket: "aprovadorgavea.firebasestorage.app",
  messagingSenderId: "503833605863",
  appId: "1:503833605863:web:b7621b8e85d94ef4b15442"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Documento único onde os saldos ficam salvos
const SALDOS_REF = doc(db, "config", "saldos");

// Expõe tudo que o firebase-auth.js e o script.js vão usar
window.BimerFirebase = {
  auth, db, SALDOS_REF,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  getDoc, setDoc,
};