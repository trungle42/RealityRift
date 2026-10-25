/** Both editions share the campaign catalogs and StoryProvider contract. */
async function boot(): Promise<void> {
  if (new URLSearchParams(location.search).get('mode') === 'classic') {
    await import('./classic');
    return;
  }
  const { Adventure } = await import('./adventure/Adventure');
  const game = new Adventure();
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
  await game.start();
}

void boot().catch(() => {
  document.getElementById('loading')?.remove();
  document.querySelector('.adventure-ui')?.remove();
  const screen = document.createElement('section'); screen.className = 'loading-screen';
  const heading = document.createElement('h1'); heading.textContent = 'The world needs a moment';
  const message = document.createElement('p'); message.textContent = 'The 3D world could not load. Try again, or enter the classic fairy tale.';
  const retry = document.createElement('button'); retry.className = 'primary-button'; retry.textContent = 'Try again'; retry.onclick = () => location.reload();
  const classic = document.createElement('a'); classic.href = '?mode=classic'; classic.textContent = 'Play the classic edition';
  screen.append(heading, message, retry, classic); document.body.append(screen);
});

export {};
