// Global Application Logic (UI, Theme, Modals)

document.addEventListener('DOMContentLoaded', () => {
    // ---- Theme Toggle Logic ----
    const themeToggleBtn = document.getElementById('themeToggle');
    const htmlElement = document.documentElement;
    const themeIcon = themeToggleBtn?.querySelector('i');

    // Load saved theme
    const savedTheme = localStorage.getItem('revise-theme') || 'dark';
    htmlElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme, themeIcon);

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = htmlElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

            htmlElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('revise-theme', newTheme);
            updateThemeIcon(newTheme, themeIcon);
        });
    }

    function updateThemeIcon(theme, iconElement) {
        if (!iconElement) return;
        if (theme === 'dark') {
            iconElement.className = 'ph ph-moon';
        } else {
            iconElement.className = 'ph ph-sun';
        }
    }

    // ---- Create Post Modal Logic ----
    const openModalBtn = document.getElementById('openCreateModalBtn');
    const closeModalBtn = document.getElementById('closeCreateModalBtn');
    const modalOverlay = document.getElementById('createPostModal');

    if (openModalBtn && closeModalBtn && modalOverlay) {
        openModalBtn.addEventListener('click', () => {
            modalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
        });

        closeModalBtn.addEventListener('click', () => {
            closeModal();
        });

        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }
});
