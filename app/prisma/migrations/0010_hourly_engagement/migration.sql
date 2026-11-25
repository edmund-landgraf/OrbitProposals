-- Hourly ad-hoc work is its own engagement and pricing model at the published $175/hr rate.
ALTER TYPE "EngagementKind" ADD VALUE 'hourly';
ALTER TYPE "PricingModel" ADD VALUE 'hourly';
