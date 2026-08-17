import assert from "node:assert/strict";
import test from "node:test";

import { escapeHTML, isValidState } from "../state-validation.js";

function validState() {
    return {
        trip: {
            name: "Europa",
            startDate: "2026-06-01",
            endDate: "2026-06-10",
            currency: "EUR",
            budget: 1200,
            travelers: ["Luis", "Aura"],
        },
        destinations: [
            {
                id: "destination-1",
                createdAt: "2026-01-01T00:00:00.000Z",
                name: "Roma",
                country: "Italia",
                from: "2026-06-01",
                to: "2026-06-03",
                notes: "",
            },
        ],
        itinerary: [
            {
                id: "activity-1",
                createdAt: "2026-01-01T00:00:00.000Z",
                title: "Coliseo",
                date: "2026-06-02",
                time: "09:30",
                location: "Roma",
                category: "Plan",
                destinationId: "destination-1",
                notes: "",
            },
        ],
        expenses: [
            {
                id: "expense-1",
                createdAt: "2026-01-01T00:00:00.000Z",
                description: "Hotel",
                amount: 100,
                date: "2026-06-01",
                paidBy: "Luis",
                category: "Alojamiento",
            },
        ],
        reservations: [
            {
                id: "reservation-1",
                createdAt: "2026-01-01T00:00:00.000Z",
                title: "Hotel",
                type: "Hotel",
                date: "2026-06-01",
                status: "Confirmada",
                detail: "ABC123",
            },
        ],
        tasks: [
            {
                id: "task-1",
                createdAt: "2026-01-01T00:00:00.000Z",
                title: "Pasaportes",
                assignee: "Aura",
                done: false,
            },
        ],
    };
}

test("acepta un estado completo válido", () => {
    assert.equal(isValidState(validState()), true);
});

test("rechaza formas profundas, números y referencias inválidas", () => {
    const nullTrip = validState();
    nullTrip.trip = null;
    assert.equal(isValidState(nullTrip), false);

    const invalidAmount = validState();
    invalidAmount.expenses[0].amount = Number.POSITIVE_INFINITY;
    assert.equal(isValidState(invalidAmount), false);

    const invalidDate = validState();
    invalidDate.itinerary[0].date = "2026-02-30";
    assert.equal(isValidState(invalidDate), false);

    const missingDestination = validState();
    missingDestination.itinerary[0].destinationId = "destination-missing";
    assert.equal(isValidState(missingDestination), false);
});

test("rechaza IDs de inyección y escapa texto en sinks HTML", () => {
    const injectedId = validState();
    injectedId.tasks[0].id = 'task-1" onmouseover="alert(1)';
    assert.equal(isValidState(injectedId), false);
    assert.equal(
        escapeHTML('<img src=x onerror="alert(1)">'),
        "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
});
