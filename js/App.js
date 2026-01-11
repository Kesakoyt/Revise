const { HashRouter, Routes, Route } = ReactRouterDOM;
const { useState, useEffect } = React;

const Navbar = window.Navbar;
const Home = window.Home;
const Login = window.Login; // On récupère notre nouvelle page

// Pages placeholders
const Shorts = () => <div className="pt-20 text-center text-gray-500">📺 Les Shorts arrivent bientôt !</div>;
const Game = () => <div className="pt-20 text-center text-gray-500">🎮 Le jeu est en construction...</div>;
const Profile = ({ user, handleLogout }) => (
    <div className="pt-24 px-4 text-center">
        {user ? (
            <div>
                <img src={user.photoURL} className="w-24 h-24 rounded-full mx-auto mb-4 border-4 border-purple-100" />
                <h2 className="text-2xl font-bold">{user.displayName}</h2>
                <p className="text-gray-500 mb-6">{user.email}</p>
                <button onClick={handleLogout} className="bg-red-100 text-red-600 px-6 py-2 rounded-full font-medium">
                    Se déconnecter
                </button>
            </div>
        ) : (
            <p>Tu n'es pas connecté.</p>
        )}
    </div>
);

function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Écouteur de connexion Firebase (La magie opère ici)
    useEffect(() => {
        const unsubscribe = firebase.auth().onAuthStateChanged((currentUser) => {
            setUser(currentUser);
            setLoading(false);
            console.log("Utilisateur connecté :", currentUser ? currentUser.displayName : "Non");
        });
        return () => unsubscribe(); // Nettoyage
    }, []);

    const handleLogout = async () => {
        await firebase.auth().signOut();
        window.location.href = "/"; // Force le rechargement vers l'accueil
    };

    if (loading) return <div className="flex h-screen items-center justify-center">Chargement...</div>;

    return (
        <HashRouter>
            <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
                {/* On passe l'info 'user' à la Navbar pour qu'elle change d'aspect */}
                <Navbar user={user} />
                
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/shorts" element={<Shorts />} />
                    <Route path="/game" element={<Game />} />
                    <Route path="/profile" element={<Profile user={user} handleLogout={handleLogout} />} />
                </Routes>
            </div>
        </HashRouter>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
