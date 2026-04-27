import { httpBatchLink } from "@trpc/client";

httpBatchLink({
  url: "http://localhost:3001/trpc",
});
