// Example for the Codaryn code task. The bug is intentional: sum([]) returns undefined.
export function sum(values) {
  let total = values[0];
  for (let index = 1; index < values.length; index += 1) total += values[index];
  return total;
}
