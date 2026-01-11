// js/firebase.js
const firebaseConfig = {
    apiKey: "AIzaSyD0J27oBxUbZG4ucVJG8kPLuG21nP7mAck",
    authDomain: "revise-61c6b.firebaseapp.com",
    projectId: "revise-61c6b",
    storageBucket: "revise-61c6b.firebasestorage.app",
    messagingSenderId: "412050181768",
    appId: "1:412050181768:web:7fffb7e0306c2d2b11d93d",
    measurementId: "G-RTXCZMXX5Y"
};

// On utilise 'firebase' directement car les scripts sont chargés dans index.html
firebase.initializeApp(firebaseConfig);

// Variables globales
window.db = firebase.firestore();
window.auth = firebase.auth();
window.googleProvider = new firebase.auth.GoogleAuthProvider();

console.log("Firebase connecté ✅");
