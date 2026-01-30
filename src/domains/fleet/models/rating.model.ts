import { Schema, model, Document } from 'mongoose';

export interface IRating extends Document {
    ratingId: string;
    tripId: string;
    passengerId: string;
    driverId: string;

    score: number; // 1-5
    comment?: string;
    tags: string[]; // ['Friendly', 'On-time', 'Safe driving']

    createdAt: Date;
    updatedAt: Date;
}

const RatingSchema = new Schema({
    ratingId: { type: String, required: true, unique: true },
    tripId: { type: String, required: true, index: true },
    passengerId: { type: String, required: true, index: true },
    driverId: { type: String, required: true, index: true },

    score: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500 },
    tags: [{ type: String }]
}, {
    timestamps: true
});

// One rating per trip per passenger
RatingSchema.index({ tripId: 1, passengerId: 1 }, { unique: true });

export const RatingModel = model<IRating>('Rating', RatingSchema);
