import { Router } from 'express';
import { serviceTokenAuth } from '../middlewares/service-token.middleware';
import { postDiscover, postLocators, postExecute } from '../controllers/qa.controller';

const router = Router();

router.use(serviceTokenAuth);

/**
 * @swagger
 * /discover:
 *   post:
 *     summary: Same-origin BFS website discovery (QA PRD 06)
 *     tags: [QA]
 *     security:
 *       - ServiceToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [base_url]
 *             properties:
 *               job_id: { type: string }
 *               base_url: { type: string }
 *               max_depth: { type: integer }
 *               max_pages: { type: integer }
 *               browser: { type: string }
 *               same_origin: { type: boolean }
 *               capture:
 *                 type: object
 *                 properties:
 *                   html_snapshot: { type: boolean }
 *                   screenshot: { type: boolean }
 *                   meta_description: { type: boolean }
 *                   page_model: { type: boolean }
 *     responses:
 *       200:
 *         description: PRD envelope { ok, pages, stats } or { ok:false, retryable, error }
 */
router.post('/discover', postDiscover);

/**
 * @swagger
 * /locators:
 *   post:
 *     summary: Extract DOM locators for pages (QA PRD 07)
 *     tags: [QA]
 *     security:
 *       - ServiceToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pages]
 *             properties:
 *               job_id: { type: string }
 *               browser: { type: string }
 *               max_per_page: { type: integer }
 *               pages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     page_id: { type: string }
 *                     url: { type: string }
 *     responses:
 *       200:
 *         description: PRD envelope { ok, results, stats }
 */
router.post('/locators', postLocators);

/**
 * @swagger
 * /execute:
 *   post:
 *     summary: Run structured test cases (QA PRD 09)
 *     tags: [QA]
 *     security:
 *       - ServiceToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [base_url, cases]
 *             properties:
 *               job_id: { type: string }
 *               base_url: { type: string }
 *               browser: { type: string }
 *               capture:
 *                 type: object
 *                 properties:
 *                   screenshot_on_failure: { type: boolean }
 *                   video: { type: boolean }
 *                   trace: { type: boolean }
 *               cases:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: PRD envelope { ok, results, stats }
 */
router.post('/execute', postExecute);

export default router;
