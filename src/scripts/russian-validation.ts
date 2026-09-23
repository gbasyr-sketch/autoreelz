type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const required: Record<string, string> = {
 name: 'Укажите имя и фамилию.', phone: 'Укажите телефон.', email: 'Укажите электронную почту.',
 city: 'Укажите город.', cityCode: 'Выберите населённый пункт из списка.', pointCode: 'Выберите пункт выдачи.',
 address: 'Укажите адрес получения.', quantity: 'Укажите количество.',
};
export function russianValidation(form: HTMLFormElement) {
 let attempted = false;
 const controls = () => [...form.querySelectorAll<Control>('input,select,textarea')];
 function refresh() {
  for (const control of controls()) {
   control.setCustomValidity('');
   const validity = control.validity;
   let message = '';
   if (control.willValidate) {
    if (validity.valueMissing) message = required[control.name] ?? 'Заполните это поле.';
    else if (validity.typeMismatch) message = control instanceof HTMLInputElement && control.type === 'email' ? 'Введите корректный адрес электронной почты.' : 'Проверьте формат значения.';
    else if (validity.tooShort) message = `Введите не менее ${(control as HTMLInputElement).minLength} символов.`;
    else if (validity.tooLong) message = `Введите не более ${(control as HTMLInputElement).maxLength} символов.`;
    else if (validity.badInput) message = 'Введите число.';
    else if (validity.rangeUnderflow) message = `Минимальное значение — ${(control as HTMLInputElement).min}.`;
    else if (validity.rangeOverflow) message = `Максимальное значение — ${(control as HTMLInputElement).max}.`;
    else if (validity.stepMismatch) message = 'Укажите целое количество.';
    else if (validity.patternMismatch) message = 'Проверьте формат значения.';
   }
   control.setCustomValidity(message);
   if (attempted && message) control.setAttribute('aria-invalid', 'true');
   else control.removeAttribute('aria-invalid');
  }
 }
 function report() {
  attempted = true; refresh();
  const invalid = controls().find(control => control.willValidate && !control.validity.valid);
  if (invalid) invalid.reportValidity();
  return !invalid;
 }
 // Validate after dynamic shipping controls have changed, using our language even
 // when the browser/OS locale is English. Native constraints remain authoritative.
 form.noValidate = true;
 form.addEventListener('input', refresh);
 form.addEventListener('change', refresh);
 form.addEventListener('submit', event => {
  if (!report()) { event.preventDefault(); event.stopImmediatePropagation(); }
 }, true);
 return {refresh, report};
}
