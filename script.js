const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('.main-nav');
menuToggle?.addEventListener('click', () => {
  const open = mainNav.classList.toggle('is-open');
  menuToggle.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.main-nav a').forEach((link) => link.addEventListener('click', () => {
  mainNav?.classList.remove('is-open');
  menuToggle?.setAttribute('aria-expanded', 'false');
}));
function submitForm(event) {
  event.preventDefault();
  const status = document.getElementById('form-status');
  status.textContent = 'Thanks — we’ll be in touch with a useful next step.';
  status.style.color = '#56c6bb';
  event.target.reset();
  return false;
}
window.submitForm = submitForm;

const toolResults = document.getElementById('tool-results');
if (toolResults && typeof proposalTools !== 'undefined') {
  const search = document.getElementById('tool-search');
  const category = document.getElementById('tool-category');
  const operation = document.getElementById('tool-operation');
  const count = document.getElementById('tool-count');
  Object.keys(toolFamilies).forEach((family) => {
    const option = document.createElement('option'); option.value = family; option.textContent = family; category.appendChild(option);
  });
  const render = () => {
    const term = search.value.trim().toLowerCase();
    const filtered = proposalTools.filter((tool) =>
      (!term || `${tool.name} ${tool.category} ${tool.description}`.toLowerCase().includes(term)) &&
      (category.value === 'all' || tool.category === category.value) &&
      (operation.value === 'all' || tool.operation === operation.value)
    );
    count.textContent = filtered.length;
    const grouped = filtered.reduce((groups, tool) => { (groups[tool.category] ||= []).push(tool); return groups; }, {});
    toolResults.innerHTML = Object.entries(grouped).map(([family, tools]) => `<section class="tool-group"><h3>${family}<span>${tools.length} tools</span></h3>${tools.map((tool) => `<div class="tool-item"><strong>${tool.name}</strong><small><b>${tool.operation}</b> · ${tool.description}</small></div>`).join('')}</section>`).join('') || '<p class="prose">No tools match that filter.</p>';
  };
  [search, category, operation].forEach((control) => control.addEventListener('input', render));
  render();
}
