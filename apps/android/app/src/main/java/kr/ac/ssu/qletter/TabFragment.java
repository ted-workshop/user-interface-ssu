package kr.ac.ssu.qletter;

import android.os.Bundle;
import android.view.View;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.fragment.app.Fragment;
import kr.ac.ssu.qletter.databinding.FragmentTabBinding;

public final class TabFragment extends Fragment {
  private static final String TAB = "tab";

  public TabFragment() {
    super(R.layout.fragment_tab);
  }

  static Fragment create(int tab) {
    TabFragment fragment = new TabFragment();
    Bundle args = new Bundle();
    args.putInt(TAB, tab);
    fragment.setArguments(args);
    return fragment;
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    int tab = requireArguments().getInt(TAB);
    FragmentTabBinding binding = FragmentTabBinding.bind(view);
    if (tab == R.id.tab_summary) binding.tabTitle.setText(R.string.page_summary);
    else if (tab == R.id.tab_reports) binding.tabTitle.setText(R.string.tab_reports);
    else if (tab == R.id.tab_channels) binding.tabTitle.setText(R.string.tab_channels);
    else if (tab == R.id.tab_account) binding.tabTitle.setText(R.string.tab_account);
    else binding.tabTitle.setText(R.string.tab_home);
    ViewCompat.setAccessibilityHeading(binding.tabTitle, true);
    if (tab == R.id.tab_account) {
      binding.sessionStatus.setVisibility(View.VISIBLE);
      SessionStore sessions = ((QletterApplication) requireActivity().getApplication()).sessions();
      sessions
          .changes()
          .observe(
              getViewLifecycleOwner(),
              ignored ->
                  binding.sessionStatus.setText(
                      sessions.isSignedIn()
                          ? R.string.session_signed_in
                          : R.string.session_signed_out));
    }
  }
}
