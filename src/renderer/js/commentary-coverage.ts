export function compactRanges(nums: number[]): string {
  if (nums.length === 0) return '';
  const ranges: string[] = [];
  let start = nums[0];
  let end = start;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === end + 1) {
      end = nums[i];
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = nums[i];
      end = start;
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(', ');
}
