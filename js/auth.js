import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const loginCard = document.getElementById('loginCard');
    const registerCard = document.getElementById('registerCard');
    const showRegisterBtn = document.getElementById('showRegisterBtn');
    const showLoginBtn = document.getElementById('showLoginBtn');

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');

    // UI Switching Logic
    if (showRegisterBtn && showLoginBtn) {
        showRegisterBtn.addEventListener('click', () => {
            loginCard.style.display = 'none';
            registerCard.style.display = 'flex';
        });

        showLoginBtn.addEventListener('click', () => {
            registerCard.style.display = 'none';
            loginCard.style.display = 'flex';
        });
    }

    // Helper functions for showing errors
    function showError(element, message) {
        element.style.display = 'block';
        element.textContent = message;
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }

    // Firebase is not initialized if the config block is empty
    const isFirebaseReady = !!auth;

    // Login Submission
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;

            if (!isFirebaseReady) {
                alert("Please add your Firebase Configuration to js/firebase-config.js!");
                return;
            }

            try {
                await signInWithEmailAndPassword(auth, email, password);
                window.location.href = 'index.html';
            } catch (error) {
                console.error(error);
                let msg = "Erreur de connexion.";
                if (error.code === 'auth/invalid-credential') msg = "Email ou mot de passe incorrect.";
                showError(loginError, msg);
            }
        });
    }

    // Register Submission
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('regUsername').value;
            const email = document.getElementById('regEmail').value;
            const password = document.getElementById('regPassword').value;

            if (!isFirebaseReady) {
                alert("Please add your Firebase Configuration to js/firebase-config.js!");
                return;
            }

            try {
                // Create user in Firebase Auth
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Create profile doc in Firestore
                await setDoc(doc(db, "users", user.uid), {
                    username: username,
                    email: email,
                    photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
                    followersCount: 0,
                    followingCount: 0,
                    bio: "Étudiant(e) motivé(e) ! 📚",
                    createdAt: new Date().toISOString()
                });

                window.location.href = 'index.html';
            } catch (error) {
                console.error(error);
                let msg = "Erreur lors de l'inscription.";
                if (error.code === 'auth/email-already-in-use') msg = "Cet email est déjà utilisé.";
                if (error.code === 'auth/weak-password') msg = "Le mot de passe doit faire au moins 6 caractères.";
                showError(registerError, msg);
            }
        });
    }

    // Check Auth State on other pages (e.g. index.html)
    if (isFirebaseReady) {
        onAuthStateChanged(auth, async (user) => {
            const isAuthPage = window.location.pathname.includes('auth.html');

            // Redirect to auth if not logged in and not on auth page
            // (Commented out for demonstration purposes so the design can be viewed without Firebase)
            /*
            if (!user && !isAuthPage) {
                window.location.href = 'auth.html';
            }
            */

            // Redirect to index if logged in and on auth page
            if (user && isAuthPage) {
                window.location.href = 'index.html';
            }

            // If user is logged in, update UI
            if (user && !isAuthPage) {
                // Fetch User Profile from Firestore to update Nav
                try {
                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    if (userDoc.exists()) {
                        const userData = userDoc.data();

                        // Update User Menu in Sidebar
                        const userMenu = document.getElementById('userMenu');
                        if (userMenu) {
                            userMenu.innerHTML = `
                                <img src="${userData.photoURL}" alt="User Avatar" class="user-avatar-placeholder" style="object-fit:cover;">
                                <div class="user-info-mini">
                                    <span class="username">${userData.username}</span>
                                    <span style="font-size:12px; color:var(--text-muted); padding-top:2px;">Déconnexion</span>
                                </div>
                            `;

                            // Attach logout logic to the user menu button
                            userMenu.addEventListener('click', () => {
                                if (confirm("Voulez-vous vous déconnecter ?")) {
                                    signOut(auth).then(() => {
                                        window.location.reload();
                                    });
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                }
            }
        });
    }
});
