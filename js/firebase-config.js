import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0J27oBxUbZG4ucVJG8kPLuG21nP7mAck",
  authDomain: "revise-61c6b.firebaseapp.com",
  projectId: "revise-61c6b",
  storageBucket: "revise-61c6b.firebasestorage.app",
  messagingSenderId: "412050181768",
  appId: "1:412050181768:web:7fffb7e0306c2d2b11d93d",
  measurementId: "G-RTXCZMXX5Y"
};

let app, auth, db;
if (Object.keys(firebaseConfig).length > 0) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("Firebase initialized");
} else {
  console.warn("Firebase config is empty. Please add your config in js/firebase-config.js.");
}

export { auth, db };
