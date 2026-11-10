for (const button of document.querySelectorAll('[data-print]')) {
  button.addEventListener('click', () => window.print())
  button.hidden = false
}

const comparison = document.querySelector('.comparison')
const split = document.querySelector('#split')
const percentage = document.querySelector('output[for="split"]')

function updateComparison() {
  comparison.style.setProperty('--split', `${split.value}%`)
  percentage.value = `${split.value}%`
}

split.addEventListener('input', updateComparison)
updateComparison()
comparison.classList.add('interactive')
comparison.querySelector('.compare-controls').hidden = false
