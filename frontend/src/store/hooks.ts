/**
 * Типизированные хуки Redux (RTK best practice): useAppDispatch знает про thunk-middleware,
 * поэтому dispatch(thunk(...)) типобезопасен. Используется governance-петлёй (T-10) и любыми
 * будущими async-домменами (техсбои и т.п.), чтобы не типизировать dispatch в каждом компоненте.
 */
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from './index';

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
