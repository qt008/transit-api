import { Schema, model, Document } from 'mongoose';

export interface ISchedule extends Document {
    scheduleId: string;
    routeId: string;
    vehicleId: string;
    driverId: string;
    operatorId: string;

    // Timing
    departureTime: string; // HH:MM format (e.g., "07:30")
    frequency: number; // Minutes between trips (0 = one-time)
    daysOfWeek: number[]; // [0-6] Sunday=0, Monday=1, etc.

    // Validity
    validFrom: Date;
    validTo: Date;
    isActive: boolean;

    createdAt: Date;
    updatedAt: Date;
}

const ScheduleSchema = new Schema({
    scheduleId: { type: String, required: true, unique: true },
    routeId: { type: String, required: true, index: true },
    vehicleId: { type: String, required: true, index: true },
    driverId: { type: String, required: true, index: true },
    operatorId: { type: String, required: true, index: true },

    departureTime: { type: String, required: true },
    frequency: { type: Number, default: 0 },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],

    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

export const ScheduleModel = model<ISchedule>('Schedule', ScheduleSchema);
