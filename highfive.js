// The high five widget on the landing page. The count lives in KV behind
// /api/highfive; this file is only the hand that taps it. The celebration is
// canvas-confetti (vendor/confetti.min.js), which is optional: without it the
// widget still counts, it just does not throw hands across the page.
(function highFive() {
    const root = document.getElementById('highFive');
    if (!root) return;

    const button = document.getElementById('highFiveButton');
    const number = document.getElementById('highFiveNumber');
    const note = document.getElementById('highFiveNote');

    const STORAGE_KEY = 'highfived';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let count = null;
    let mine = localStorage.getItem(STORAGE_KEY) === '1';
    let inFlight = false;

    // Count up to the new number instead of snapping to it. Short enough that
    // it reads as a tick, not an animation you have to wait out.
    function render(value, animate) {
        if (!animate || reduceMotion || count === null) {
            number.textContent = value.toLocaleString();
            return;
        }

        const from = count;
        const start = performance.now();
        const span = Math.min(600, 120 + Math.abs(value - from) * 12);

        (function step(now) {
            const t = Math.min(1, (now - start) / span);
            const eased = 1 - Math.pow(1 - t, 3);
            number.textContent = Math.round(from + (value - from) * eased).toLocaleString();
            if (t < 1) requestAnimationFrame(step);
        })(start);
    }

    function setMine(value) {
        mine = value;
        root.classList.toggle('is-mine', value);
        note.textContent = value ? "you're in the count" : '';
        button.setAttribute('aria-pressed', String(value));
        try {
            if (value) localStorage.setItem(STORAGE_KEY, '1');
            else localStorage.removeItem(STORAGE_KEY);
        } catch {
            // Private mode. The server remembers anyway.
        }
    }

    // A short, small burst in the page's own two colours. On a page this quiet
    // a shower of emoji would be the loudest thing on it.
    function celebrate() {
        if (typeof window.confetti !== 'function') return;

        const box = root.getBoundingClientRect();
        const origin = {
            x: (box.left + 20) / window.innerWidth,
            y: (box.top + box.height / 2) / window.innerHeight,
        };

        // canvas-confetti sits this out on its own when the visitor asked for
        // reduced motion, so there is no branch for it here.
        confetti({
            particleCount: 18,
            spread: 55,
            startVelocity: 22,
            scalar: 0.7,
            ticks: 90,
            gravity: 1.1,
            colors: ['#f0e9dd', '#8f897f'],
            origin,
            disableForReducedMotion: true,
        });
    }

    // Restart the nod on every click, so a repeat five still registers as
    // contact even though it does not count twice.
    function slap() {
        root.classList.remove('is-slapped');
        void root.offsetWidth;
        root.classList.add('is-slapped');
    }

    button.addEventListener('click', () => {
        slap();

        // A second click is a real thing to do and should feel like something,
        // but it is not a second person, so it never touches the server and
        // does not get the confetti.
        if (mine || inFlight || count === null) return;

        inFlight = true;
        celebrate();

        const optimistic = count + 1;
        render(optimistic, true);
        count = optimistic;
        setMine(true);

        fetch('/api/highfive', { method: 'POST' })
            .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
            .then((data) => {
                if (typeof data.count !== 'number') return;
                render(data.count, data.count !== count);
                count = data.count;
            })
            .catch(() => {
                // The optimistic bump stands for this visit rather than
                // flickering back down; the next load reads the truth.
            })
            .finally(() => {
                inFlight = false;
            });
    });

    fetch('/api/highfive')
        .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
        .then((data) => {
            if (typeof data.count !== 'number') return;
            render(data.count, true);
            count = data.count;
            // The server is the authority, and it wins even when it disagrees
            // with local storage. Someone whose click never landed, because the
            // API was down or their marker aged out, gets to high five again
            // instead of being locked out by a stale flag in their browser.
            setMine(data.you === true);
        })
        .catch(() => {
            // No count, no widget. Better than a sticker advertising a zero
            // that never moves, which is what GitHub Pages would show.
            root.hidden = true;
        });
}());
