TestCalculateXDirect: perfect score, граничные 0.81/0.61/0.41/0.21, clamp>1, округление 4 знака
- TestCalculateXInverse: ноль дефектов→1.0, половина→0.5, все дефекты→0.0, clamp<0
- TestEdgeCases: b=0 (DIRECT/INVERSE), a=None, b=None, оба None, неверный formula_type→ValueError
- TestBoundaryValues: @pytest.mark.parametrize — 11 контрольных пар из эталонного Excel