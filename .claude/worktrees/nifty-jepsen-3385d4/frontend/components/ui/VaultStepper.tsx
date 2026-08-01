'use client';

interface VaultStepperProps {
  currentStep: number;
  totalSteps: number;
}

export default function VaultStepper({ currentStep, totalSteps }: VaultStepperProps) {
  const createVaultSteps = [
    { number: 1, label: 'Source Chain' },
    { number: 2, label: 'Amount & Duration' },
    { number: 3, label: 'Vault Type' },
    { number: 4, label: 'Review' },
    { number: 5, label: 'Confirm' },
  ];
  const steps = createVaultSteps.slice(0, totalSteps);

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.number} className="flex flex-1 items-center">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all ${
                currentStep >= step.number
                  ? 'bg-primary text-dark'
                  : 'bg-primary/20 text-primary/60'
              }`}
            >
              {currentStep > step.number ? '✓' : step.number}
            </div>

            <div className="ml-3 flex-1">
              <div
                className={`text-sm font-medium ${
                  currentStep >= step.number ? 'text-primary' : 'text-light/60'
                }`}
              >
                {step.label}
              </div>
              <div className="text-xs text-light/40">Step {step.number}</div>
            </div>

            {index < steps.length - 1 && (
              <div
                className={`mx-2 h-0.5 flex-1 transition-all ${
                  currentStep > step.number ? 'bg-primary' : 'bg-primary/20'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-primary/10">
        <div
          className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
          style={{ width: `${(currentStep / totalSteps) * 100}%` }}
        />
      </div>
    </div>
  );
}
