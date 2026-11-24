"""Rule thresholds: the 2026 rulebook (v2.1 + proposals 2026-2, -3 and -10, adopted Nov 2026).
here is hard-coded elsewhere: every rule check reads a RulesConfig."""

from dataclasses import asdict, dataclass, fields, replace

PENALTY_KINDS = (
    "delayed_pass",  # 3.1
    "false_grab",  # 3.2
    "premature_grab",  # 3.3
    "spoon_tamper",  # 3.4
    "card_pass",  # 3.5 improper card passing
    "hand_manipulation",  # 3.5 direct manipulation of an opponent's hand
    "physical_harm",  # 3.6
)


@dataclass(frozen=True)
class RulesConfig:
    division_threshold: int = 16  # 2.1.3: MORE than this many participants → divisions (2026-3)
    max_per_table: int = 16  # 1.2.1: no table seats more (2026-3)
    false_grab_dq_at: int = 2  # 3.2: this many false grabs in a tournament → DQ prompt
    card_pass_forfeit_at: int = 3  # 3.5: this offense number is a card forfeit
    second_dealer_at: int = 8  # 1.3.3 (2026-4): a round starting with this many seated → 2 dealers
    immediate_dq: tuple[str, ...] = ("spoon_tamper", "hand_manipulation")  # 3.4, 3.5
    spoon_layout: str = "between"  # default for new tables: rule 1.2.2 (2026-2); "center" was v2.1
    between_inset: float = 1 / 3  # "between" spoons sit this fraction of the short side in

    def with_overrides(self, overrides: dict | None) -> "RulesConfig":
        if not overrides:
            return self
        known = {f.name for f in fields(self)}
        unknown = set(overrides) - known
        if unknown:
            raise ValueError(f"unknown rule override(s): {sorted(unknown)}")
        if "immediate_dq" in overrides:
            overrides = {**overrides, "immediate_dq": tuple(overrides["immediate_dq"])}
        out = replace(self, **overrides)
        out.validate()
        return out

    def validate(self) -> None:
        for name, low in (
            ("division_threshold", 2),
            ("max_per_table", 2),
            ("false_grab_dq_at", 1),
            ("card_pass_forfeit_at", 1),
            ("second_dealer_at", 2),
        ):
            v = getattr(self, name)
            if not isinstance(v, int) or isinstance(v, bool) or v < low:
                raise ValueError(f"{name} must be a whole number of at least {low}")
        if self.spoon_layout not in ("center", "between"):
            raise ValueError("spoon_layout must be 'center' or 'between'")
        if not isinstance(self.between_inset, int | float) or not 0 < self.between_inset < 0.5:
            raise ValueError("between_inset must be between 0 and 0.5")
        if not set(self.immediate_dq) <= set(PENALTY_KINDS):
            raise ValueError(f"immediate_dq must only list {PENALTY_KINDS}")

    def to_dict(self) -> dict:
        return asdict(self)


DEFAULT_RULES = RulesConfig()
