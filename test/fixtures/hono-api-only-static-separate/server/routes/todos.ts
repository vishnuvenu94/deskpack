export function listTodos(c: { body: (value: string) => unknown; json: (value: unknown) => unknown }) {
  c.json({ todos: [] });
  return c.body("api response");
}
