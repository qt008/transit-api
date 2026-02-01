import { FastifyRequest, FastifyReply } from 'fastify';
import { UploadService } from '../services/upload.service';

export class UploadController {

    static async upload(req: FastifyRequest, reply: FastifyReply) {
        try {
            const data = await (req as any).file();
            if (!data) {
                return reply.status(400).send({ error: 'No file uploaded' });
            }

            const uploadService = new UploadService();
            const fileBuffer = await data.toBuffer();
            const folder = (req.query as any).folder || 'misc';

            const url = await uploadService.uploadDocument(
                fileBuffer,
                data.filename,
                folder
            );

            return reply.send({
                success: true,
                data: { url, filename: data.filename }
            });
        } catch (err: any) {
            req.log.error(err);
            return reply.status(500).send({ error: 'File upload failed' });
        }
    }
}
