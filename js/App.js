const { HashRouter, Routes, Route } = ReactRouterDOM;

// On récupère les composants qu'on a créés dans les autres fichiers
const Navbar = window.Navbar;
const Home = window.Home;

// Pages temporaires pour les liens vides
const Shorts = () => <div className="pt-20 text-center text-gray-500">📺 Les Shorts arrivent bientôt !</div>;
const Game = () => <div className="pt-20 text-center text-gray-500">🎮 Le jeu est en construction...</div>;
const Profile = () => <div className="pt-20 text-center text-gray-500">👤 Connecte-toi pour voir ton profil.</div>;

function App() {
    return (
        <HashRouter>
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/shorts" element={<Shorts />} />
                    <Route path="/game" element={<Game />} />
                    <Route path="/profile" element={<Profile />} />
                </Routes>
            </div>
        </HashRouter>
    );
}

// Démarrage de React
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
