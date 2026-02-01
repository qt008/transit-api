import AWS from 'aws-sdk';
import { randomUUID } from 'crypto';

export class UploadService {
    private s3: AWS.S3;
    private bucket: string;

    constructor() {
        this.s3 = new AWS.S3({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            region: process.env.AWS_REGION
        });
        this.bucket = process.env.S3_BUCKET || 'transitghana-documents';
    }

    async uploadDocument(file: Buffer, fileName: string, folder: string): Promise<string> {
        const key = `${folder}/${randomUUID()}-${fileName}`;

        await this.s3.putObject({
            Bucket: this.bucket,
            Key: key,
            Body: file,
            ContentType: this.getContentType(fileName),
            ACL: 'private'
        }).promise();

        // Assuming CloudFront or public bucket
        // If private, we might need signed URLs, but for now returning S3 URL
        return `https://${this.bucket}.s3.amazonaws.com/${key}`;
    }

    private getContentType(fileName: string): string {
        const ext = fileName.split('.').pop()?.toLowerCase();
        const types: Record<string, string> = {
            'pdf': 'application/pdf',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        return types[ext || ''] || 'application/octet-stream';
    }
}
