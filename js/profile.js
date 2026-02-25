import { auth, db } from './firebase-config.js';
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', async () => {
    // Get user ID from URL or default to current user later
    const urlParams = new URLSearchParams(window.location.search);
    let targetUserId = urlParams.get('user');

    const profilePostsContainer = document.getElementById('profilePostsContainer');

    if (!db) {
        if (profilePostsContainer) profilePostsContainer.innerHTML = "<p style='text-align:center; padding: 40px;'>Firestore non initialisé. Veuillez configurer Firebase.</p>";
        return;
    }

    onAuthStateChanged(auth, async (user) => {
        // If no user ID in URL, we assume they want to see their own profile
        if (!targetUserId) {
            if (user) {
                targetUserId = user.uid;
            } else {
                // Not logged in and no user specified: redirect or ask to login
                document.getElementById('profUsername').textContent = "Non connecté";
                document.getElementById('profBio').textContent = "Veuillez vous connecter pour voir votre profil.";
                return;
            }
        }

        // Setup Profile UI based on targetUserId
        await loadProfile(targetUserId);
        await loadUserPosts(targetUserId);

        // Setup Actions (Follow vs Edit Profile)
        const followBtn = document.getElementById('followBtn');
        const editProfileBtn = document.getElementById('editProfileBtn');

        if (user && user.uid === targetUserId) {
            // Viewing own profile
            if (editProfileBtn) editProfileBtn.style.display = 'inline-flex';
        } else if (user) {
            // Viewing someone else's profile
            if (followBtn) {
                followBtn.style.display = 'inline-flex';
                // Placeholder follow toggle
                followBtn.addEventListener('click', () => {
                    alert("Abonnement réussi ! (Simulation)");
                    followBtn.innerHTML = '<i class="ph ph-check"></i> Abonné';
                    followBtn.classList.replace('btn-primary', 'btn-outline');
                });
            }
        }
    });

    async function loadProfile(uid) {
        try {
            const userRef = doc(db, "users", uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                const data = userSnap.data();
                document.getElementById('profUsername').textContent = data.username || 'Utilisateur inconnu';
                document.getElementById('profBio').textContent = data.bio || 'Aucune biographie.';

                const avatarImg = document.getElementById('profAvatar');
                if (avatarImg && data.photoURL) avatarImg.src = data.photoURL;

                // Load stats
                document.getElementById('profFollowersCount').textContent = data.followersCount || 0;
                document.getElementById('profFollowingCount').textContent = data.followingCount || 0;
            } else {
                document.getElementById('profUsername').textContent = "Utilisateur introuvable";
                document.getElementById('profBio').textContent = "Ce compte n'existe pas ou a été supprimé.";
            }
        } catch (error) {
            console.error("Error fetching user profile:", error);
        }
    }

    async function loadUserPosts(uid) {
        try {
            const postsRef = collection(db, "posts");
            const q = query(postsRef, where("authorId", "==", uid), orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);

            if (profilePostsContainer) {
                profilePostsContainer.innerHTML = ''; // Clear loading

                // Also update Post Count Stat here
                document.getElementById('profPostsCount').textContent = querySnapshot.size;

                if (querySnapshot.empty) {
                    profilePostsContainer.innerHTML = "<p style='text-align:center; color: var(--text-muted); padding: 40px;'>Aucun post pour le moment.</p>";
                    return;
                }

                querySnapshot.forEach((doc) => {
                    const post = doc.data();
                    renderPost(post, doc.id, profilePostsContainer);
                });
            }
        } catch (error) {
            console.error("Error fetching user posts:", error);
            if (profilePostsContainer) profilePostsContainer.innerHTML = "<p style='text-align:center; color: var(--danger); padding: 40px;'>Impossible de charger les posts.</p>";
        }
    }

    // --- Render Post Utility (Similar to feed.js) ---
    function renderPost(postData, postId, container) {
        let timeString = 'À l\'instant';
        if (postData.createdAt?.toDate) {
            const date = postData.createdAt.toDate();
            timeString = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        }

        const article = document.createElement('article');
        article.className = 'post-card glass-panel';
        article.dataset.id = postId;

        let mediaHtml = '';
        if (postData.videoUrl) mediaHtml += `<a href="${postData.videoUrl}" target="_blank" class="post-link">🔗 Voir la vidéo</a>`;
        if (postData.imageUrl) mediaHtml += `<img src="${postData.imageUrl}" alt="Post image" class="post-image" loading="lazy">`;

        const html = `
            <div class="post-header">
                <img src="${postData.authorAvatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=fallback'}" alt="Avatar" class="post-avatar">
                <div class="post-meta">
                    <h3 class="post-author">${postData.authorName}</h3>
                    <span class="post-time">${timeString}</span>
                </div>
            </div>
            <div class="post-content">
                <p>${escapeHTML(postData.content)}</p>
                ${mediaHtml}
            </div>
            <div class="post-actions">
                <button class="action-btn like-btn">
                    <i class="ph ph-heart"></i>
                    <span>${postData.likesCount || 0}</span>
                </button>
                <button class="action-btn comment-btn">
                    <i class="ph ph-chat-circle"></i>
                    <span>${postData.commentsCount || 0}</span>
                </button>
            </div>
        `;

        article.innerHTML = html;
        container.appendChild(article);
    }

    function escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
});
