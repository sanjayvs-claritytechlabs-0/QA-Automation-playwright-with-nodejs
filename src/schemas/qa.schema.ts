import { z } from 'zod';

export const discoverRequestSchema = z.object({
  job_id: z.string().optional(),
  base_url: z.string().url(),
  // Soft validate; service clamps to hard caps (depth≤5, pages≤200) per PRD
  max_depth: z.number().int().min(0).optional(),
  max_pages: z.number().int().min(1).optional(),
  browser: z.string().optional(),
  same_origin: z.boolean().optional().default(true),
  capture: z
    .object({
      html_snapshot: z.boolean().optional(),
      screenshot: z.boolean().optional(),
      meta_description: z.boolean().optional(),
      page_model: z.boolean().optional(),
    })
    .optional(),
});

export const locatorsRequestSchema = z.object({
  job_id: z.string().optional(),
  browser: z.string().optional(),
  max_per_page: z.number().int().min(1).max(500).optional(),
  pages: z
    .array(
      z.object({
        page_id: z.string().min(1),
        url: z.string().url(),
      })
    )
    .min(1),
});

const locatorObjectSchema = z.object({
  id: z.string().optional(),
  strategy: z.string().min(1),
  selector: z.string().min(1),
  role: z.string().nullable().optional(),
  accessible_name: z.string().nullable().optional(),
});

export const executeRequestSchema = z.object({
  job_id: z.string().optional(),
  base_url: z.string().url(),
  browser: z.string().optional(),
  capture: z
    .object({
      screenshot_on_failure: z.boolean().optional(),
      video: z.boolean().optional(),
      trace: z.boolean().optional(),
    })
    .optional(),
  cases: z
    .array(
      z.object({
        test_case_id: z.string().min(1),
        test_plan_id: z.string().optional(),
        title: z.string().optional(),
        steps: z.array(
          z.object({
            ordinal: z.number().optional(),
            action: z.string().min(1),
            locator: locatorObjectSchema.nullable().optional(),
            value: z.union([z.string(), z.null()]).optional(),
            description: z.string().optional(),
          })
        ),
        assertions: z
          .array(
            z.object({
              type: z.string().min(1),
              expected: z.union([z.string(), z.null()]).optional(),
              locator_id: z.string().nullable().optional(),
              locator: locatorObjectSchema.nullable().optional(),
            })
          )
          .optional(),
      })
    )
    .min(1),
});
