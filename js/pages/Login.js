// js/pages/Login.js
const { useNavigate } = ReactRouterDOM;

window.Login = function() {
    const navigate = useNavigate();
    const [error, setError] = React.useState(null);

    const handleGoogleLogin = async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await firebase.auth().signInWithPopup(provider);
            // Une fois connecté, on renvoie vers l'accueil
            navigate('/');
        } catch (err) {
            console.error("Erreur connexion:", err);
            setError("Erreur lors de la connexion Google. Réessaie.");
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
                
                {/* Logo animé ou icône */}
                <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl animate-bounce">
                    🧠
                </div>

                <h2 className="text-3xl font-bold text-gray-900 mb-2">Bienvenue sur Révise</h2>
                <p className="text-gray-500 mb-8">Partage ta connaissance et apprends en t'amusant.</p>

                {/* Bouton Google */}
                <button 
                    onClick={handleGoogleLogin}
                    className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 px-4 rounded-xl transition duration-300 shadow-sm group"
                >
                    <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-6 h-6" alt="Google" />
                    <span>Continuer avec Google</span>
                </button>

                {error && (
                    <p className="mt-4 text-red-500 text-sm">{error}</p>
                )}

                <p className="mt-8 text-xs text-gray-400">
                    En continuant, tu acceptes nos conditions d'utilisation et notre politique de confidentialité.
                </p>
            </div>
        </div>
    );
}
