import config from "../../config.ts";
import { z, getCollection, defineCollection } from "astro:content";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

const authors = Object.keys(config.authors) as [string, ...string[]];

export const collections = {
  docs: defineCollection({
    schema: docsSchema({
      extend: z.object({
        cover: z.string().optional(),
        author: z.enum(authors as [string, ...string[]]).optional(),
      }),
    })
  }),
  //i18n: defineCollection({ type: "data", schema: i18nSchema() }),
};
