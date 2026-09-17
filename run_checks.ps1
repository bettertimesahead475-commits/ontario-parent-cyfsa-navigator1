$ErrorActionPreference = "Stop"

Write-Host "Running m2eIntelligence.test.ts"
npx vitest run api/services/m2eIntelligence.test.ts

Write-Host "Running m2dRelationships.test.ts"
npx vitest run api/services/m2dRelationships.test.ts

Write-Host "Running m2cClaims.test.ts"
npx vitest run api/services/m2cClaims.test.ts

Write-Host "Running m2b-chronology.test.ts"
npx vitest run api/services/m2b-chronology.test.ts

Write-Host "Running migration tests"
npx vitest run api/services/m2eIntelligenceMigration.test.ts
npx vitest run api/services/caseIntelligenceMigration.test.ts
npx vitest run api/services/m2cClaimsMigration.test.ts
npx vitest run api/services/m2dRelationshipsMigration.test.ts

Write-Host "Running full relevant suite"
npx vitest run api/services/m2eIntelligence.test.ts api/services/m2dRelationships.test.ts api/services/m2cClaims.test.ts api/services/m2b-chronology.test.ts

Write-Host "Running tsc --noEmit"
npx tsc --noEmit

Write-Host "Running npm run build"
npm run build

Write-Host "Running npm audit"
npm audit
