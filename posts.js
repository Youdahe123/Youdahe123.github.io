// Shared posts API client, used by admin.html, writing.html, and post.html.
// Reads and writes both go through /api/posts, which the Worker serves from KV
// so a post published from the admin page is live without a redeploy.
const POSTS_API = '/api/posts';

async function getPosts() {
    try {
        const res = await fetch(POSTS_API);
        const posts = await res.json();
        return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch {
        return [];
    }
}

async function addPost(title, content, preview, date) {
    const res = await fetch(POSTS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, preview, date }),
    });
    return res.json();
}

async function deletePost(id) {
    await fetch(`${POSTS_API}?id=${id}`, { method: 'DELETE' });
}

async function getPost(id) {
    const posts = await getPosts();
    return posts.find(p => p.id === id) || null;
}

async function uploadImage(file) {
    const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
            'Content-Type': file.type,
            'x-filename': file.name,
        },
        body: file,
    });
    const data = await res.json();
    return data.url;
}

function renderPostContent(content) {
    return content.split('\n').filter(l => l.trim()).map(line => {
        const imgMatch = line.trim().match(/^\{\{img:(.+?)\}\}$/);
        if (imgMatch) {
            return `<img src="${imgMatch[1]}" alt="Post image" class="post-image">`;
        }
        // `## text` on its own line becomes a section heading
        const headingMatch = line.trim().match(/^##\s+(.+)$/);
        if (headingMatch) {
            return `<h2 class="post-h2">${headingMatch[1]}</h2>`;
        }
        return `<p>${line}</p>`;
    }).join('');
}
