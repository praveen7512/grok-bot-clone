package com.botclone.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Dark = darkColorScheme(
    primary = Color(0xFFE8EAED),
    onPrimary = Color(0xFF0E0F12),
    primaryContainer = Color(0xFF2A2D34),
    onPrimaryContainer = Color(0xFFE8EAED),
    secondary = Color(0xFF8AB4F8),
    onSecondary = Color(0xFF0E0F12),
    tertiary = Color(0xFF81C995),
    background = Color(0xFF0E0F12),
    onBackground = Color(0xFFE8EAED),
    surface = Color(0xFF0E0F12),
    onSurface = Color(0xFFE8EAED),
    surfaceVariant = Color(0xFF1B1D22),
    onSurfaceVariant = Color(0xFF9AA0A6),
    surfaceContainer = Color(0xFF16181C),
    surfaceContainerHigh = Color(0xFF1E2026),
    surfaceContainerHighest = Color(0xFF26292F),
    outline = Color(0xFF3C4043),
    outlineVariant = Color(0xFF2A2D34),
    error = Color(0xFFF28B82),
)

private val Light = lightColorScheme(
    primary = Color(0xFF111318),
    onPrimary = Color.White,
    secondary = Color(0xFF1A73E8),
    tertiary = Color(0xFF188038),
    surfaceVariant = Color(0xFFF1F3F4),
)

@Composable
fun BotCloneTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) Dark else Light,
        typography = Typography(),
        content = content,
    )
}
