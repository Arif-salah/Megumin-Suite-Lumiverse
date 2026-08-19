// ─────────────────────────────────────────────────────────────────────────────
// The Story Director's genre table.
//
// Data, not UI. It lived in features/storyplan/ui.js because the tab was its
// only reader, but the interceptor also names a genre when it builds the
// director's prompt — and the interceptor runs in the backend, which must never
// import a file that touches the DOM.
// ─────────────────────────────────────────────────────────────────────────────

export const SD_GENRES = {
    "slice-of-life": { label: "Slice of Life", desc: "Daily rhythms, small moments, character-driven warmth." },
    "drama": { label: "Drama", desc: "Emotional conflict, relationship tension, high stakes feelings." },
    "romance": { label: "Romance", desc: "Love as the central engine — pursuit, longing, devotion." },
    "action": { label: "Action / Adventure", desc: "Physical danger, quests, combat, exploration." },
    "mystery": { label: "Mystery / Thriller", desc: "Secrets, investigation, paranoia, carefully timed reveals." },
    "fantasy": { label: "Fantasy / RPG", desc: "Magic systems, world-building, quests, power progression." },
    "horror": { label: "Horror / Dark", desc: "Dread, survival, psychological terror, body horror." },
    "scifi": { label: "Sci-Fi", desc: "Technology, space, dystopia, transhumanism." },
    "comedy": { label: "Comedy", desc: "Humor-driven, absurdist, sitcom energy, comedic timing." }
};
