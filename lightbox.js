// Photo story viewer.
//
// Clicking a photo opens it large with its story beside it. The open is a FLIP
// animation: the final layout is measured first, then the figure is pushed back
// to where the thumbnail sits and released, so the picture appears to lift off
// the grid and turn to face you rather than cross-fading into place. Closing
// runs the same move backwards, onto whichever photo is showing, so arrowing
// through the gallery and then closing still lands on the right tile.

(function () {
    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;

    const photos = [...document.querySelectorAll('.photo-open')];
    if (!photos.length) return;

    const card = lightbox.querySelector('.lightbox-card');
    const frame = lightbox.querySelector('.lightbox-frame');
    const img = lightbox.querySelector('.lightbox-img');
    const story = lightbox.querySelector('.lightbox-story');
    const titleEl = lightbox.querySelector('.lightbox-title');
    const textEl = lightbox.querySelector('.lightbox-text');
    const countEl = lightbox.querySelector('.lightbox-count');

    const stories = typeof PHOTO_STORIES === 'undefined' ? {} : PHOTO_STORIES;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const EASE = 'cubic-bezier(.16, 1, .3, 1)';
    const OPEN_MS = 620;
    const CLOSE_MS = 400;

    let index = -1;
    let animating = false;
    let lastFocus = null;

    const keyFor = (el) => (el.getAttribute('src').split('/').pop() || '').replace(/\.[a-z]+$/i, '');

    function fill(i) {
        const source = photos[i];
        const entry = stories[keyFor(source)];

        img.src = source.currentSrc || source.src;
        img.alt = source.alt || '';

        // A photo with no entry shows just the picture, so half-written story
        // data never leaves an empty panel hanging next to it.
        const has = Boolean(entry && (entry.title || entry.story));
        story.hidden = !has;
        card.classList.toggle('is-bare', !has);
        titleEl.textContent = has ? (entry.title || '') : '';
        textEl.textContent = has ? (entry.story || '') : '';
        countEl.textContent = `${i + 1} / ${photos.length}`;
    }

    // Where the thumbnail sits, as a transform onto the figure's resting place.
    function deltaFrom(el) {
        const from = el.getBoundingClientRect();
        const to = frame.getBoundingClientRect();
        if (!to.width || !to.height) return null;
        return {
            x: from.left + from.width / 2 - (to.left + to.width / 2),
            y: from.top + from.height / 2 - (to.top + to.height / 2),
            sx: from.width / to.width,
            sy: from.height / to.height,
        };
    }

    function open(i, trigger) {
        if (animating) return;
        index = i;
        lastFocus = trigger || document.activeElement;

        lightbox.hidden = false;
        document.body.classList.add('lightbox-open');
        fill(i);

        const run = () => {
            lightbox.classList.add('is-open');
            const d = deltaFrom(photos[i]);
            if (!d || reduced.matches) {
                story.hidden || story.animate(
                    [{ opacity: 0 }, { opacity: 1 }],
                    { duration: 200, fill: 'both' },
                );
                lightbox.querySelector('.lightbox-close').focus({ preventScroll: true });
                return;
            }

            animating = true;
            const anim = card.animate([
                {
                    transform: `translate3d(${d.x}px, ${d.y}px, -240px) scale(${d.sx}, ${d.sy}) rotateY(-16deg)`,
                    opacity: 0.35,
                },
                { transform: 'translate3d(0, 0, 0) scale(1, 1) rotateY(0deg)', opacity: 1 },
            ], { duration: OPEN_MS, easing: EASE, fill: 'both' });

            if (!story.hidden) {
                story.animate([
                    { opacity: 0, transform: 'translate3d(28px, 0, 0)' },
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' },
                ], { duration: 460, delay: 180, easing: EASE, fill: 'both' });
            }

            anim.finished.then(() => {
                animating = false;
                lightbox.querySelector('.lightbox-close').focus({ preventScroll: true });
            }).catch(() => { animating = false; });
        };

        // Decoding first means the figure is measured at its real aspect ratio,
        // so the animation does not start from a collapsed box.
        if (img.decode) img.decode().then(run).catch(run);
        else requestAnimationFrame(run);
    }

    function close() {
        if (animating || lightbox.hidden) return;
        const target = photos[index];

        const done = () => {
            lightbox.classList.remove('is-open');
            lightbox.hidden = true;
            document.body.classList.remove('lightbox-open');
            img.removeAttribute('src');
            animating = false;
            if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
        };

        const d = target ? deltaFrom(target) : null;
        if (!d || reduced.matches) return done();

        animating = true;
        if (!story.hidden) {
            story.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'both' });
        }
        card.animate([
            { transform: 'translate3d(0, 0, 0) scale(1, 1) rotateY(0deg)', opacity: 1 },
            {
                transform: `translate3d(${d.x}px, ${d.y}px, -200px) scale(${d.sx}, ${d.sy}) rotateY(12deg)`,
                opacity: 0,
            },
        ], { duration: CLOSE_MS, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' })
            .finished.then(done).catch(done);
    }

    // Stepping sideways is a short swap in place rather than a full reopen, so
    // holding an arrow key does not queue up a lift animation per photo.
    function step(dir) {
        if (animating || lightbox.hidden) return;
        const next = (index + dir + photos.length) % photos.length;
        index = next;

        const out = card.animate([
            { opacity: 1, transform: 'translate3d(0,0,0) rotateY(0deg)' },
            { opacity: 0, transform: `translate3d(${dir * -34}px, 0, -120px) rotateY(${dir * 9}deg)` },
        ], { duration: reduced.matches ? 0 : 190, easing: 'ease-in', fill: 'both' });

        out.finished.then(() => {
            fill(next);
            const show = () => card.animate([
                { opacity: 0, transform: `translate3d(${dir * 34}px, 0, -120px) rotateY(${dir * -9}deg)` },
                { opacity: 1, transform: 'translate3d(0,0,0) rotateY(0deg)' },
            ], { duration: reduced.matches ? 0 : 340, easing: EASE, fill: 'both' });
            if (img.decode) img.decode().then(show).catch(show);
            else show();
        }).catch(() => {});
    }

    photos.forEach((el, i) => {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.addEventListener('click', () => open(i, el));
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open(i, el);
            }
        });
    });

    lightbox.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) return close();
        if (e.target.closest('[data-prev]')) return step(-1);
        if (e.target.closest('[data-next]')) return step(1);
    });

    document.addEventListener('keydown', (e) => {
        if (lightbox.hidden) return;
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });

    // A resize mid-open would leave the close animation aiming at a tile that
    // has since moved, so the figure is re-measured rather than flown home.
    window.addEventListener('resize', () => {
        if (!lightbox.hidden) card.getAnimations().forEach((a) => a.finish());
    });
})();
