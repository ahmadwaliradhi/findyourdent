// Quiz component. Markup: <div class="quiz" data-answer="2" data-why="..."> <p>Q</p> <button>..</button> x4 <p class="fb"></p></div>
document.querySelectorAll(".quiz").forEach((q) => {
  const answer = Number(q.dataset.answer);
  const fb = q.querySelector(".fb");
  q.querySelectorAll("button").forEach((b, i) => {
    b.addEventListener("click", () => {
      const right = i === answer;
      b.style.outline = `2px solid var(${right ? "--ok" : "--accent"})`;
      fb.textContent = (right ? "Right. " : "Not quite. ") + q.dataset.why;
    });
  });
});
