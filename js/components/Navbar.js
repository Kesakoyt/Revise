const { Link, useLocation } = ReactRouterDOM;

window.Navbar = function() {
    const location = useLocation();
    const activePath = location.pathname;

    const navItems = [
        { path: '/', label: 'Accueil', icon: 'fa-home' },
        { path: '/shorts', label: 'Shorts', icon: 'fa-video' },
        { path: '/game', label: 'Jeu', icon: 'fa-gamepad' },
        { path: '/profile', label: 'Profil', icon: 'fa-user' },
    ];

    return (
        <React.Fragment>
            {/* Desktop Navbar */}
            <nav className="fixed top-0 w-full bg-white border-b z-50 px-4 h-16 flex items-center justify-between shadow-sm hidden md:flex">
                <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-blue-500">
                    Révise 🧠
                </h1>
                <div className="flex gap-6">
                    {navItems.map((item) => (
                        <Link key={item.path} to={item.path} className={`font-medium hover:text-purple-600 transition ${activePath === item.path ? 'text-purple-600' : 'text-gray-600'}`}>
                            <i className={`fas ${item.icon} mr-2`}></i>{item.label}
                        </Link>
                    ))}
                </div>
            </nav>

            {/* Mobile Navbar (Bottom) */}
            <nav className="fixed bottom-0 w-full bg-white border-t z-50 h-16 flex justify-around items-center md:hidden pb-1">
                {navItems.map((item) => (
                    <Link key={item.path} to={item.path} className="flex flex-col items-center w-full py-1">
                        <i className={`fas ${item.icon} text-xl mb-1 transition ${activePath === item.path ? 'text-purple-600 -translate-y-1' : 'text-gray-400'}`}></i>
                        <span className={`text-[10px] ${activePath === item.path ? 'text-purple-600 font-bold' : 'text-gray-500'}`}>
                            {item.label}
                        </span>
                    </Link>
                ))}
            </nav>
        </React.Fragment>
    );
}
