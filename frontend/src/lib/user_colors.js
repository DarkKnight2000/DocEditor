// One colour per person, picked from their user id, so the same person looks the same everywhere:
// their avatar's initial (light background, dark letter) and their cursor in the editor (solid colour).

export const USER_COLORS = [
    { avatar: 'bg-sky-100 text-sky-800', cursor: '#0284c7' },
    { avatar: 'bg-pink-100 text-pink-800', cursor: '#db2777' },
    { avatar: 'bg-emerald-100 text-emerald-800', cursor: '#059669' },
    { avatar: 'bg-violet-100 text-violet-800', cursor: '#7c3aed' },
    { avatar: 'bg-orange-100 text-orange-800', cursor: '#ea580c' },
    { avatar: 'bg-teal-100 text-teal-800', cursor: '#0d9488' },
];

/** @param {string} id */
export function userColor(id)
{
    let hash = 0;
    for(const ch of id ?? '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return USER_COLORS[hash % USER_COLORS.length];
}
