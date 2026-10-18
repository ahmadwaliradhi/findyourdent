Button triggers one action: submit the complaint, record a voice note, search for an IGD. Use one `primary` per view, `secondary` or `outline` for the alternative, `ghost` for low-emphasis actions such as "Lewati", and `danger` only for destructive actions such as deleting your own Testimony.

The consumer provides the label (a verb phrase), an optional leading `icon`, and the handler. Make the main call to action `lg` and `block` on mobile. Every size is at least 44px tall; keep 8px between neighbouring buttons. While work is pending, pass `loading` and keep the label ("Sedang memproses…") so the button never changes width or loses its meaning.

Do: label with a verb, keep text on one line, give a disabled button a reason nearby. Don't: use two primaries side by side, put an icon alone in a button without an accessible name, or use `danger` for the emergency link (that is a link to a map, so use `primary` or `outline`).
