/**
 * Sanitizes news content, removing CDATA and unescaping HTML entities.
 */
export function cleanNewsString(input: string | undefined): string {
  if (!input) return '';
  
  // 1. Remove CDATA tags: <![CDATA[ content ]]>
  let cleaned = input.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
  
  // 2. Unescape HTML entities (basic approach)
  cleaned = cleaned
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
    
  return cleaned.trim();
}
