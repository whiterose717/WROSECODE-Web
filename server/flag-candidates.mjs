// Pattern matches are hints, never assertions that the CTF platform accepted a flag.
// Keep this limited to explicit, brace-delimited flag forms to reduce false positives.
export const FLAG_PATTERN = /\b(?:HTB|flag|CTF|picoCTF|THM|DUCTF|corCTF|uiuctf|SEKAI|WROSE)\{[^}\r\n]{3,180}\}/gi;
export function extractFlagCandidates(value,limit=20){
 const found=new Set();const input=String(value??'');
 for(const match of input.matchAll(FLAG_PATTERN)){
  if(found.size>=limit)break;
  found.add(match[0]);
 }
 return [...found];
}
