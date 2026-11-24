let last: Promise<unknown> = Promise.resolve();
export const oneLoad = <T>(run: () => Promise<T>): Promise<T> => {
  const mine = last.then(run, run);
  last = mine.catch(() => undefined);
  return mine;
};
