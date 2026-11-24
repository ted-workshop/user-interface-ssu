package kr.ac.ssu.qletter.report;

import android.os.Bundle;
import android.view.View;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.fragment.app.FragmentTransaction;
import androidx.lifecycle.Lifecycle;
import com.google.android.material.tabs.TabLayout;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.collection.CollectionsFragment;
import kr.ac.ssu.qletter.databinding.FragmentReportsTabBinding;

/** #29의 모음 화면은 수정하지 않고 리포트 탭 안에서 열어요. */
public final class ReportsTabFragment extends Fragment {
  private FragmentReportsTabBinding binding;
  private int selected;
  private final FragmentManager.OnBackStackChangedListener backStack = this::showHeader;

  public ReportsTabFragment() {
    super(R.layout.fragment_reports_tab);
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle saved) {
    binding = FragmentReportsTabBinding.bind(view);
    selected = saved == null ? 0 : saved.getInt("section", 0);
    ViewCompat.setAccessibilityHeading(binding.reportsTitle, true);
    binding.reportSections.addTab(binding.reportSections.newTab().setText(R.string.report_mine));
    binding.reportSections.addTab(
        binding.reportSections.newTab().setText(R.string.report_collections));
    binding.reportSections.selectTab(binding.reportSections.getTabAt(selected));
    binding.reportSections.addOnTabSelectedListener(
        new TabLayout.OnTabSelectedListener() {
          @Override
          public void onTabSelected(TabLayout.Tab tab) {
            select(tab.getPosition());
          }

          @Override
          public void onTabUnselected(TabLayout.Tab tab) {}

          @Override
          public void onTabReselected(TabLayout.Tab tab) {}
        });
    getChildFragmentManager().addOnBackStackChangedListener(backStack);
    if (getChildFragmentManager().findFragmentById(R.id.reports_content) == null) select(selected);
    showHeader();
  }

  private void select(int section) {
    selected = section;
    FragmentManager manager = getChildFragmentManager();
    String tag = section == 0 ? "library" : "collections";
    Fragment current = manager.findFragmentByTag(tag);
    FragmentTransaction change = manager.beginTransaction().setReorderingAllowed(true);
    for (Fragment fragment : manager.getFragments())
      if (fragment != current)
        change.hide(fragment).setMaxLifecycle(fragment, Lifecycle.State.CREATED);
    if (current == null) {
      current = section == 0 ? new ReportListFragment() : new CollectionsFragment();
      change.add(R.id.reports_content, current, tag);
    } else change.show(current).setMaxLifecycle(current, Lifecycle.State.RESUMED);
    change.setPrimaryNavigationFragment(current).commitNow();
  }

  private void showHeader() {
    if (binding != null)
      binding.reportsHeader.setVisibility(
          getChildFragmentManager().getBackStackEntryCount() == 0 ? View.VISIBLE : View.GONE);
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle out) {
    super.onSaveInstanceState(out);
    out.putInt("section", selected);
  }

  @Override
  public void onDestroyView() {
    getChildFragmentManager().removeOnBackStackChangedListener(backStack);
    binding = null;
    super.onDestroyView();
  }
}
