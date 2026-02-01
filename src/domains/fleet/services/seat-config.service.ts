import { VehicleType, SeatType, SeatConfiguration } from '../models/vehicle.model';

export class SeatConfigService {
    /**
     * Generate seat configuration based on vehicle type
     */
    generateSeatLayout(vehicleType: VehicleType, totalSeats: number) {
        const layouts = {
            MINI_BUS: { rows: 4, seatsPerRow: 4, columns: ['A', 'B', 'C', 'D'] },
            STANDARD_BUS: { rows: 10, seatsPerRow: 4, columns: ['A', 'B', 'C', 'D'] },
            LUXURY_COACH: { rows: 12, seatsPerRow: 4, columns: ['A', 'B', 'C', 'D'] },
            SPRINTER: { rows: 5, seatsPerRow: 4, columns: ['A', 'B', 'C', 'D'] }
        };

        const layout = layouts[vehicleType as keyof typeof layouts];
        if (!layout) {
            // Fallback default layout
            return [];
        }

        const seats: SeatConfiguration[] = [];

        let seatCount = 0;
        for (let row = 1; row <= layout.rows && seatCount < totalSeats; row++) {
            for (const col of layout.columns) {
                if (seatCount >= totalSeats) break;

                seats.push({
                    seatNumber: `${row}${col}`,
                    row,
                    column: col,
                    type: SeatType.STANDARD,
                    isAvailable: true
                });
                seatCount++;
            }
        }

        return seats;
    }
}
