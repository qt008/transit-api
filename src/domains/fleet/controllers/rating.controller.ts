import { FastifyRequest, FastifyReply } from 'fastify';
import { RatingModel } from '../models/rating.model';
import { TripModel } from '../models/trip.model';
import { DriverModel } from '../../identity/models/driver.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';

const RateTripSchema = z.object({
    score: z.number().min(1).max(5),
    comment: z.string().max(500).optional(),
    tags: z.array(z.string()).optional()
});

export class RatingController {

    /**
     * POST /trips/:id/rate - Rate a completed trip
     */
    static async rateTrip(req: FastifyRequest, reply: FastifyReply) {
        const { id: tripId } = req.params as { id: string };
        const { score, comment, tags } = RateTripSchema.parse(req.body);
        // @ts-ignore
        const passengerId = req.user.id;

        try {
            // Verify trip exists and is completed
            const trip = await TripModel.findOne({ tripId });
            if (!trip) throw new Error('Trip not found');
            if (trip.status !== 'COMPLETED') {
                throw new Error('Can only rate completed trips');
            }

            // Check for duplicate rating
            const existing = await RatingModel.findOne({ tripId, passengerId });
            if (existing) throw new Error('Trip already rated');

            // Create rating
            const ratingId = `RAT-${randomUUID()}`;
            const rating = await RatingModel.create({
                ratingId,
                tripId,
                passengerId,
                driverId: trip.driverId,
                score,
                comment,
                tags: tags || []
            });

            // Update driver's average rating
            await this.updateDriverRating(trip.driverId);

            return reply.status(201).send({
                success: true,
                message: 'Rating submitted',
                data: rating
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /drivers/:id/reviews - Get driver's ratings
     */
    static async getDriverReviews(req: FastifyRequest, reply: FastifyReply) {
        const { id: driverId } = req.params as { id: string };
        const params = getPaginationParams(req);

        const [reviews, total] = await Promise.all([
            RatingModel.find({ driverId })
                .sort({ createdAt: -1 })
                .skip(params.skip)
                .limit(params.limit),
            RatingModel.countDocuments({ driverId })
        ]);

        return reply.send(createPaginatedResponse(reviews, total, params));
    }

    /**
     * GET /drivers/:id/rating-summary - Driver rating summary
     */
    static async getRatingSummary(req: FastifyRequest, reply: FastifyReply) {
        const { id: driverId } = req.params as { id: string };

        const summary = await RatingModel.aggregate([
            { $match: { driverId } },
            {
                $group: {
                    _id: '$driverId',
                    avgRating: { $avg: '$score' },
                    totalRatings: { $sum: 1 },
                    fiveStars: { $sum: { $cond: [{ $eq: ['$score', 5] }, 1, 0] } },
                    fourStars: { $sum: { $cond: [{ $eq: ['$score', 4] }, 1, 0] } },
                    threeStars: { $sum: { $cond: [{ $eq: ['$score', 3] }, 1, 0] } },
                    twoStars: { $sum: { $cond: [{ $eq: ['$score', 2] }, 1, 0] } },
                    oneStar: { $sum: { $cond: [{ $eq: ['$score', 1] }, 1, 0] } }
                }
            }
        ]);

        const result = summary[0] || {
            avgRating: 0,
            totalRatings: 0,
            fiveStars: 0,
            fourStars: 0,
            threeStars: 0,
            twoStars: 0,
            oneStar: 0
        };

        return reply.send({
            success: true,
            data: result
        });
    }

    /**
     * Update driver average rating
     */
    private static async updateDriverRating(driverId: string) {
        const stats = await RatingModel.aggregate([
            { $match: { driverId } },
            {
                $group: {
                    _id: '$driverId',
                    avgRating: { $avg: '$score' }
                }
            }
        ]);

        if (stats.length > 0) {
            await DriverModel.updateOne(
                { driverId },
                { rating: Number(stats[0].avgRating.toFixed(2)) }
            );
        }
    }
}
