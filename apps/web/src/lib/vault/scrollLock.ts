/*
 * The front door and the strong room each hold the page still while they are
 * up, and their lives can overlap (the front door stands over the strong room).
 * A shared count keeps one from releasing the other's hold: the page scrolls
 * again only when the last holder lets go.
 */

let holders = 0;
let original = "";

/** Stops the page scrolling; call the returned function to let go. */
export function holdPageStill(): () => void {
  const html = document.documentElement;
  if (holders === 0) {
    original = html.style.overflow;
    html.style.overflow = "hidden";
  }
  holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) html.style.overflow = original;
  };
}
