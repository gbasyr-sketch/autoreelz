const catalog = document.querySelector<HTMLElement>('[data-catalog]');
const dialog = document.querySelector<HTMLDialogElement>('#cat-filter-dialog');
const content = document.querySelector<HTMLElement>('#cat-filter-content');
const mount = document.querySelector<HTMLElement>('[data-catalog-dialog-mount]');
const trigger = document.querySelector<HTMLButtonElement>('[data-open-catalog-filters]');

if (catalog && dialog && content && mount && trigger && typeof dialog.showModal === 'function') {
  const home = content.parentElement!;
  const mobile = window.matchMedia('(max-width: 900px)');
  let returnFocus: HTMLElement | null = null;
  catalog.dataset.enhanced = '';

  const openFilters = (opener: HTMLElement) => {
    if (!mobile.matches || dialog.open) return;
    returnFocus = opener;
    mount.append(content);
    dialog.showModal();
    document.documentElement.classList.add('cat-filters-open');
  };

  trigger.addEventListener('click', () => openFilters(trigger));
  document.querySelector('[data-close-catalog-filters]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    home.append(content);
    document.documentElement.classList.remove('cat-filters-open');
    if (mobile.matches && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  });
  mobile.addEventListener('change', () => {
    if (dialog.open) dialog.close();
  });
  document.querySelector<HTMLAnchorElement>('[data-edit-catalog-filters]')?.addEventListener('click', event => {
    const link = event.currentTarget as HTMLAnchorElement;
    if (mobile.matches) {
      event.preventDefault();
      openFilters(link);
    }
    const field = content.querySelector<HTMLElement>('[aria-invalid="true"]') ?? content.querySelector<HTMLElement>('select');
    field?.focus();
  });
}

const sortForm = document.querySelector<HTMLFormElement>('.cat-sort-form');
if (sortForm) {
  sortForm.dataset.enhanced = '';
  sortForm.querySelector('select')?.addEventListener('change', () => sortForm.requestSubmit());
}
