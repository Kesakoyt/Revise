window.Home = function() {
    // Exemple simple de State (état)
    const [likes, setLikes] = React.useState(0);

    return (
        <div className="pt-4 pb-24 px-4 max-w-2xl mx-auto md:pt-24">
            
            {/* En-tête Mobile */}
            <div className="flex justify-between items-center mb-6 md:hidden">
                <h1 className="text-xl font-bold text-purple-600">Révise 🧠</h1>
                <i className="fas fa-search text-gray-500 text-lg"></i>
            </div>

            {/* Filtres */}
            <div className="flex gap-2 overflow-x-auto mb-6 pb-2 scrollbar-hide">
                {['Tout', 'Maths', 'Histoire', 'Sciences', 'Anglais'].map((cat, i) => (
                    <button key={i} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition ${i===0 ? 'bg-black text-white shadow-lg' : 'bg-gray-100 text-gray-600'}`}>
                        {cat}
                    </button>
                ))}
            </div>

            {/* Carte de contenu (Exemple) */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                        <i className="fas fa-atom"></i>
                    </div>
                    <div>
                        <h4 className="font-bold text-sm">Science_Junior</h4>
                        <p className="text-xs text-gray-500">Il y a 2h • Physique</p>
                    </div>
                </div>
                
                <h3 className="font-bold text-lg mb-2">Pourquoi le ciel est bleu ? 🌍</h3>
                <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    C'est à cause de la diffusion de Rayleigh ! La lumière du soleil contient toutes les couleurs, mais l'atmosphère diffuse (éparpille) beaucoup plus le bleu que le rouge.
                </p>

                <div className="flex items-center gap-6 border-t pt-3 text-gray-500">
                    <button onClick={() => setLikes(likes + 1)} className={`flex items-center gap-2 text-sm ${likes > 0 ? 'text-red-500' : ''}`}>
                        <i className={`${likes > 0 ? 'fas' : 'far'} fa-heart`}></i> {likes > 0 ? likes : "J'aime"}
                    </button>
                    <button className="flex items-center gap-2 text-sm">
                        <i className="far fa-comment"></i> Commenter
                    </button>
                    <button className="flex items-center gap-2 text-sm ml-auto">
                        <i className="far fa-bookmark"></i>
                    </button>
                </div>
            </div>

        </div>
    );
}
