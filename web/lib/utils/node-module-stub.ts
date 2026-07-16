export function createRequire(_url: string) {
  return (id: string) => {
    throw new Error('node:module is not available in client bundle');
  };
}
