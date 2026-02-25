import { auth, db } from './firebase-config.js';
import {
    collection,
    addDoc,
    getDocs,
    query,
    orderBy,
    serverTimestamp,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let currentUserData = null;

    // Check auth to get user before posting
    if (auth) {
        onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            if (user) {
                // Fetch profile data for the create post modal
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    currentUserData = userDoc.data();
                    const modalAvatar = document.getElementById('currentUserModalAvatar');
                    if (modalAvatar) modalAvatar.src = currentUserData.photoURL;
                }
            }
        });
    }

    // --- Fetch Posts ---
    const feedContainer = document.getElementById('feedContainer');

    async function loadPosts() {
        if (!feedContainer) return;

        if (!db) {
            console.warn("Firestore not initialized. Displaying placeholder UI only.");
            return; // Fallback to HTML placeholders
        }

        try {
            const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);

            // Clear placeholders if we have real data (or keep them if empty)
            if (!querySnapshot.empty) {
                feedContainer.innerHTML = '';

                querySnapshot.forEach((doc) => {
                    const post = doc.data();
                    renderPost(post, doc.id);
                });
            }
        } catch (error) {
            console.error("Error fetching posts:", error);
        }
    }

    // Call initially
    loadPosts();

    // --- Create Post ---
    const submitPostBtn = document.getElementById('submitPostBtn');

    if (submitPostBtn) {
        submitPostBtn.addEventListener('click', async () => {
            if (!currentUser || !currentUserData) {
                alert("Vous devez être connecté pour publier un post.");
                window.location.href = 'auth.html';
                return;
            }

            const textSnippet = document.getElementById('postTextSnippet').value;
            const subject = document.getElementById('postSubject').value;
            const imageUrl = document.getElementById('postImageUrl').value;
            const videoUrl = document.getElementById('postVideoUrl').value;

            if (!textSnippet.trim() && !imageUrl && !videoUrl) {
                alert("Le post ne peut pas être vide.");
                return;
            }

            // Disable button during submit
            submitPostBtn.disabled = true;
            submitPostBtn.textContent = 'Publication...';

            try {
                await addDoc(collection(db, "posts"), {
                    authorId: currentUser.uid,
                    authorName: currentUserData.username,
                    authorAvatar: currentUserData.photoURL,
                    subject: subject,
                    content: textSnippet,
                    imageUrl: imageUrl || null,
                    videoUrl: videoUrl || null,
                    likesCount: 0,
                    commentsCount: 0,
                    createdAt: serverTimestamp()
                });

                // Reset modal
                document.getElementById('postTextSnippet').value = '';
                document.getElementById('postImageUrl').value = '';
                document.getElementById('postVideoUrl').value = '';

                document.getElementById('createPostModal').classList.remove('active');
                document.body.style.overflow = '';

                // Reload posts
                loadPosts();
            } catch (error) {
                console.error("Error adding document: ", error);
                alert("Une erreur est survenue lors de la création du post.");
            } finally {
                submitPostBtn.disabled = false;
                submitPostBtn.textContent = 'Publier';
            }
        });
    }

    // --- Render Post Utility ---
    function renderPost(postData, postId) {
        // Handle timestamps gracefully if still pending
        let timeString = 'À l\'instant';
        if (postData.createdAt?.toDate) {
            const date = postData.createdAt.toDate();
            timeString = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        }

        const article = document.createElement('article');
        article.className = 'post-card glass-panel';
        article.dataset.id = postId;

        let mediaHtml = '';

        // Handle Youtube Link transformation to iframe
        if (postData.videoUrl) {
            const videoId = extractYouTubeID(postData.videoUrl);
            if (videoId) {
                mediaHtml += `
                <div class="video-container">
                    <iframe src="https://www.youtube.com/embed/${videoId}" 
                            title="YouTube video player" frameborder="0" 
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                            allowfullscreen>
                    </iframe>
                </div>`;
            } else {
                // Generic video link fallback
                mediaHtml += `<a href="${postData.videoUrl}" target="_blank" class="post-link">🔗 Regarder la vidéo</a>`;
            }
        }

        // Handle Image
        if (postData.imageUrl) {
            mediaHtml += `<img src="${postData.imageUrl}" alt="Post attachment" class="post-image" loading="lazy">`;
        }

        const html = `
            <div class="post-header">
                <a href="profile.html?user=${postData.authorId}">
                    <img src="${postData.authorAvatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=fallback'}" alt="Avatar" class="post-avatar">
                </a>
                <div class="post-meta">
                    <a href="profile.html?user=${postData.authorId}" style="text-decoration:none; color:inherit;">
                        <h3 class="post-author">${postData.authorName}</h3>
                    </a>
                    <span class="post-time">${timeString} • ${formatSubject(postData.subject)}</span>
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
        feedContainer.appendChild(article);
    }

    // --- Helpers ---
    function extractYouTubeID(url) {
        const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function formatSubject(val) {
        const subjects = {
            general: 'Général',
            maths: 'Mathématiques',
            physique: 'Physique-Chimie',
            svt: 'SVT',
            philo: 'Philosophie',
            histoire: 'Histoire-Géo',
            langues: 'Langues'
        };
        return subjects[val] || val || 'Sujet optionnel';
    }

    function escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
});
